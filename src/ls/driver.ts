import AbstractDriver from '@sqltools/base-driver';
import {
  IConnectionDriver,
  MConnectionExplorer,
  NSDatabase,
  ContextValue,
  Arg0,
} from "@sqltools/types";
import { v4 as generateId } from 'uuid';
import { BigQuery } from '@google-cloud/bigquery';
import queries from './queries';

type DriverLib = any;
type DriverOptions = any;

export default class BigQueryDriver extends AbstractDriver<DriverLib, DriverOptions> implements IConnectionDriver {
  public readonly deps: typeof AbstractDriver.prototype['deps'] = [
    {
      type: AbstractDriver.CONSTANTS.DEPENDENCY_PACKAGE,
      name: '@google-cloud/bigquery',
    },
  ];

  queries = queries;


  public async open() {

    let connOptions = {
			keyFilename: this.credentials.database,
      projectId: this.credentials.projectId,
		};

    this.connection = new Promise((resolve, reject) => {
    const bigquery = new BigQuery({ ...connOptions, maxRetries: 10 });
    resolve(bigquery);
    });
  }
  

  public async close() {
    if (!this.connection) return Promise.resolve();

    this.connection = null;
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

  public query: (typeof AbstractDriver)['prototype']['query'] = async (query, opt = {}) => {
    await this.open();
    const bigquery = await this.connection;
    const options = {
      query: query,
    };
    const resultsAgg: NSDatabase.IResult[] = [];

      const [rows] = await bigquery.query(options);
      resultsAgg.push({
        cols: Object.keys(rows[0]),
        connId: this.getId(),
        messages: [{ date: new Date(), message: `Query executed successfully` }],
        results: rows,
        query,
        requestId: opt.requestId,
        resultId: generateId(),
      });

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
          ];
      case ContextValue.TABLE:
        return this.getColumns(item as NSDatabase.ITable);  
      case ContextValue.VIEW:
        return this.getColumns(item as NSDatabase.ITable);
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

}

