import AbstractDriver from '@sqltools/base-driver';
import {
  IConnectionDriver,
  MConnectionExplorer,
  NSDatabase,
  ContextValue,
  Arg0,
} from "@sqltools/types";
import { v4 as generateId } from 'uuid';
import queries from './queries';
import { standardizeResult }  from './utils';
import { JSONClient } from 'google-auth-library/build/src/auth/googleauth';

type DriverLib = any;
type DriverOptions = any;

export default class BigQueryDriver extends AbstractDriver<DriverLib, DriverOptions> implements IConnectionDriver {
  public readonly deps: typeof AbstractDriver.prototype['deps'] = [
    {
      type: AbstractDriver.CONSTANTS.DEPENDENCY_PACKAGE,
      name: '@google-cloud/bigquery',
      version: '7.9.0'
    },
    {
      type: AbstractDriver.CONSTANTS.DEPENDENCY_PACKAGE,
      name: 'google-auth-library',
      version: '9.14.1'
    },
  ];

  queries = queries;

  private _sessionId?: string;
  private _paginationCache?: Map<string, { total: number; exact: boolean; resultId: string }>;

  public async open() {
    const BigQuery = this.requireDep('@google-cloud/bigquery').BigQuery;
    const OAuth2Client = this.requireDep('google-auth-library').OAuth2Client;
    const getCredentials = () => {


      const authentication_method = this.credentials.authenticator
      if (authentication_method === 'CLI') {
        return {
          projectId: this.credentials.projectId,
          location: this.credentials.location
        };
      } else if (authentication_method === 'OAUTH') {
        const access_token = this.credentials.token;
        const oauth = new OAuth2Client();
        oauth.setCredentials({ access_token });

        return {
          // is this a legit way to handle this typescript error
          authClient: oauth as JSONClient,
          projectId: this.credentials.projectId,
          location: this.credentials.location
        };
      } else {
        return {
          keyFilename: this.credentials.keyfile,
          location: this.credentials.location
        }
      };
    }

    let connOptions = getCredentials();

    this.connection = new Promise((resolve, reject) => {
      try {
        const bigquery = new BigQuery({ ...connOptions, maxRetries: 10 });
        resolve(bigquery);
      } catch (error) {
        reject(error);
      }
    });

    const initSql = this.credentials.connectionInitSql;
    if (initSql && !this._sessionId) {
      const bigquery = await this.connection;
      try {
        const [job] = await bigquery.createQueryJob({
          query: initSql,
          location: this.credentials.location,
          createSession: true,
        });
        await job.getQueryResults();
        const [metadata] = await job.getMetadata();
        const sessionId = metadata?.statistics?.sessionInfo?.sessionId;
        if (!sessionId) {
          throw new Error('BigQuery did not return a session id for the init session');
        }
        this._sessionId = sessionId;
      } catch (error) {
        this.connection = null;
        throw new Error('Connection init SQL failed: ' + (error && error.message || error));
      }
    }
  }


  public async close() {
    if (!this.connection) return Promise.resolve();

    this.connection = null;
    this._sessionId = undefined;
    this._paginationCache = undefined;
  }

  public async testConnection() {
    try {
      await this.open();
      const bigquery = await this.connection;
      await bigquery.query('SELECT 1');
      await this.close();

    } catch (error) {
      throw new Error('Failed to connect to BigQuery: ' + error.message);
    }
  }

  public singleQuery: (typeof AbstractDriver)['prototype']['singleQuery'] = ((query: any, opt: any) => {
    return this.query(query, { ...opt, __internal: true }).then(([res]) => res);
  }) as any;

  private _isPaginatableSelect(sql: string): boolean {
    if (this.credentials.disablePagination) return false;
    const withoutComments = sql.toString().replace(/^\s*(--[^\n]*\n)+/, '').trim();
    if (!/^(SELECT|WITH)\b/i.test(withoutComments)) return false;
    const withoutTrailingSemi = withoutComments.replace(/;\s*$/, '');
    // reject multiple statements
    return !/;\s*\S/.test(withoutTrailingSemi);
  }

  private _stripTrailingSemicolon(sql: string): string {
    return sql.toString().replace(/;\s*$/, '');
  }

  private _buildConnectionProperties() {
    if (this._sessionId) {
      return [{ key: 'session_id', value: this._sessionId }];
    }
    return undefined;
  }

  private _buildDmlOutcomeMessage(statementType: string, metadata: any): string {
    const queryStats = metadata && metadata.statistics && metadata.statistics.query;
    let affected: number | undefined;
    const dmlStats = queryStats && queryStats.dmlStats;
    if (dmlStats) {
      affected = Number(dmlStats.insertedRowCount || 0) + Number(dmlStats.updatedRowCount || 0) + Number(dmlStats.deletedRowCount || 0);
    } else if (queryStats && queryStats.numDmlAffectedRows !== undefined) {
      affected = Number(queryStats.numDmlAffectedRows);
    }
    const label = statementType || 'Statement';
    return `${label} executed successfully.${affected !== undefined ? ` ${affected} rows were affected.` : ''}`;
  }

  private async _getPaginationState(bigquery: any, baseSql: string, baseOptions: any, requestId: string, page: number, offset: number, rowsLen: number, hasMore: boolean) {
    this._paginationCache = this._paginationCache || new Map();
    const key = `${requestId} ${baseSql}`;
    const cached = this._paginationCache.get(key);
    const resultId = (cached && cached.resultId) || generateId();

    if (cached && cached.exact) {
      return { total: cached.total, exact: true, resultId };
    }

    const estimate = offset + rowsLen + (hasMore ? 1 : 0);
    let total = estimate;
    let exact = false;

    const skipCount = !!this.credentials.disablePaginationCount;
    if (page === 0 && !skipCount) {
      try {
        const [job] = await bigquery.createQueryJob({ ...baseOptions, query: `SELECT COUNT(1) AS total FROM (${baseSql})` });
        const [countRows] = await job.getQueryResults();
        total = Number(countRows[0].total);
        exact = true;
      } catch (error) {
        total = estimate;
        exact = false;
      }
    }

    if (this._paginationCache.size >= 100 && !this._paginationCache.has(key)) {
      const firstKey = this._paginationCache.keys().next().value;
      this._paginationCache.delete(firstKey);
    }
    this._paginationCache.set(key, { total, exact, resultId });
    return { total, exact, resultId };
  }

  private async _execPaginatedSelect(bigquery: any, rawSql: string, baseOptions: any, opt: any): Promise<NSDatabase.IResult> {
    const page = opt.page || 0;
    const pageSize = opt.pageSize || this.credentials.previewLimit || 50;
    const offset = page * pageSize;
    const base = this._stripTrailingSemicolon(rawSql);
    const limitedSql = `${base} LIMIT ${pageSize + 1} OFFSET ${offset}`;

    const [job] = await bigquery.createQueryJob({ ...baseOptions, query: limitedSql });
    const [rows] = await job.getQueryResults();
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const standardizedRows = await standardizeResult(pageRows);

    const { total, exact, resultId } = await this._getPaginationState(bigquery, base, baseOptions, opt.requestId, page, offset, pageRows.length, hasMore);
    const message = exact
      ? `Showing page ${page + 1} of ${Math.max(1, Math.ceil(total / pageSize))} (${total} rows).`
      : `Showing page ${page + 1} (at least ${total} rows).`;

    return {
      cols: standardizedRows && standardizedRows.length ? Object.keys(standardizedRows[0]) : ['No rows returned'],
      connId: this.getId(),
      messages: [{ date: new Date(), message }],
      results: standardizedRows,
      query: rawSql,
      requestId: opt.requestId,
      resultId,
      page,
      pageSize,
      total,
      queryType: 'executeQuery',
      queryParams: base,
    } as unknown as NSDatabase.IResult;
  }

  public query: (typeof AbstractDriver)['prototype']['query'] = async (query, opt: any = {}) => {
    await this.open();
    const bigquery = await this.connection;
    const rawSql = String(query);
    const baseOptions: any = {
      location: this.credentials.location,
    };
    const connectionProperties = this._buildConnectionProperties();
    if (connectionProperties) {
      baseOptions.connectionProperties = connectionProperties;
    }

    const resultsAgg: NSDatabase.IResult[] = [];

    if (!opt.__internal && this._isPaginatableSelect(rawSql)) {
      resultsAgg.push(await this._execPaginatedSelect(bigquery, rawSql, baseOptions, opt));
      return resultsAgg;
    }

    const [job] = await bigquery.createQueryJob({ ...baseOptions, query: rawSql });
    const [rows] = await job.getQueryResults();
    const [metadata] = await job.getMetadata();
    const statementType = metadata?.statistics?.query?.statementType;
    const isSelectLike = !statementType || statementType === 'SELECT' || statementType === 'SCRIPT';
    const standardizedRows = await standardizeResult(rows);

    if (!Array.isArray(rows) || !rows.length) {
      if (isSelectLike) {
        resultsAgg.push({
          cols: ['No rows returned'],
          connId: this.getId(),
          messages: [{ date: new Date(), message: `Query executed successfully but no data was returned` }],
          results: [],
          query: rawSql,
          requestId: opt.requestId,
          resultId: generateId(),
        });
      } else {
        const outcome = this._buildDmlOutcomeMessage(statementType, metadata);
        resultsAgg.push({
          cols: ['Statement', 'Result'],
          connId: this.getId(),
          messages: [{ date: new Date(), message: outcome }],
          results: [{ Statement: rawSql, Result: outcome }],
          query: rawSql,
          requestId: opt.requestId,
          resultId: generateId(),
        });
      }
    } else {
      resultsAgg.push({
        cols: standardizedRows && standardizedRows.length && Object.keys(standardizedRows[0]),
        connId: this.getId(),
        messages: [{ date: new Date(), message: `Query executed successfully` }],
        results: standardizedRows,
        query: rawSql,
        requestId: opt.requestId,
        resultId: generateId(),
      });
    }
    return resultsAgg;
  }


  private async getColumns(
    parent: NSDatabase.ITable
  ): Promise<NSDatabase.IColumn[]> {
    const results = await this.queryResults(this.queries.fetchColumns(parent));
    return results.map((col) => ({
      ...col,
      iconName: col.isPk ? "pk" : null,
      childType: ContextValue.NO_CHILD,
      table: parent,
    }));
  }



  /**
   * This method is a helper to generate the connection explorer tree.
   * it gets the child items based on current item
   */
  public async getChildrenForItem({
    item,
    parent,
  }: Arg0<IConnectionDriver["getChildrenForItem"]>) {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return this.queryResults(this.queries.fetchDatabases())
      case ContextValue.DATABASE:
        return (this.queryResults(this.queries.fetchSchemas(parent as NSDatabase.IDatabase)));
      case ContextValue.SCHEMA:
        return <MConnectionExplorer.IChildItem[]>[
          {
            label: "Tables",
            type: ContextValue.RESOURCE_GROUP,
            iconId: "folder",
            childType: ContextValue.TABLE,
          },
          {
            label: "Views",
            type: ContextValue.RESOURCE_GROUP,
            iconId: "folder",
            childType: ContextValue.VIEW,
          },
          {
            label: "Routines",
            type: ContextValue.RESOURCE_GROUP,
            iconId: "folder",
            childType: ContextValue.FUNCTION,
          }
        ];
      case ContextValue.TABLE:
        return this.getColumns(item as NSDatabase.ITable);
      case ContextValue.VIEW:
        return this.getColumns(item as NSDatabase.ITable);
      case ContextValue.FUNCTION:
        return this.queryResults(this.queries.fetchRoutineInfo(item as NSDatabase.ITable));
      case ContextValue.RESOURCE_GROUP:
        return this.getChildrenForGroup({ item, parent });
    }
    return [];
  }

  /**
   * This method is a helper to generate the connection explorer tree.
   * It gets the child based on child types
   */
  private async getChildrenForGroup({
    parent,
    item,
  }: Arg0<IConnectionDriver["getChildrenForItem"]>) {
    switch (item.childType) {
      case ContextValue.TABLE:
        // return both tables and external tables
        return this.queryResults(
          this.queries.fetchTables(parent as NSDatabase.ISchema)
        );
      case ContextValue.VIEW:
        return this.queryResults(
          this.queries.fetchViews(parent as NSDatabase.ISchema)
        );
      case ContextValue.FUNCTION:
        return this.queryResults(
          this.queries.fetchRoutines(parent as NSDatabase.ISchema)
        );
    }
    return [];
  }

  /**
   * This method is a helper for intellisense and quick picks.
   */
  public async searchItems(
    itemType: ContextValue,
    search: string,
    extraParams: any = {}
  ): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.TABLE:
        return this.queryResults(this.queries.searchTables({ search }));
      case ContextValue.COLUMN:
        return this.queryResults(
          this.queries.searchColumns({ search, ...extraParams })
        );
    }
    return [];
  }

  
  public getStaticCompletions: IConnectionDriver['getStaticCompletions'] = async () => {
    return {};
  }

}

