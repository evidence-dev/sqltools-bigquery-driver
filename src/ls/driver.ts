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
// JSONClient type will be available at runtime from google-auth-library
type JSONClient = any;

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
      // typescript complains if this is not an array
      query: [query],
      location: this.credentials.location,
    };
    const resultsAgg: NSDatabase.IResult[] = [];

    const [rows] = await bigquery.query(options);
    const standardizedRows = await standardizeResult(rows);
    if (!Array.isArray(rows) || !rows.length) {
      resultsAgg.push({
        cols: ['No rows returned'],
        connId: this.getId(),
        messages: [{ date: new Date(), message: `Query executed successfully but no data was returned` }],
        results: [],
        // back to string
        query: query[0],
        requestId: opt.requestId,
        resultId: generateId(),
      })
    } else { 
    resultsAgg.push({
      cols: standardizedRows && standardizedRows.length && Object.keys(standardizedRows[0]),
      connId: this.getId(),
      messages: [{ date: new Date(), message: `Query executed successfully` }],
      results: standardizedRows,
      // back to string
      query: query[0],
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
      case ContextValue.DATABASE:
        // Search for projects/databases
        return this.queryResults(this.queries.searchDatabases({ search }));
      case ContextValue.SCHEMA:
        // Search for datasets/schemas
        return this.queryResults(this.queries.searchSchemas({ search, ...extraParams }));
      case ContextValue.TABLE:
        return this.queryResults(this.queries.searchTables({ search, ...extraParams }));
      case ContextValue.VIEW:
        return this.queryResults(this.queries.searchViews({ search, ...extraParams }));
      case ContextValue.COLUMN:
        return this.queryResults(
          this.queries.searchColumns({ search, ...extraParams })
        );
      case ContextValue.FUNCTION:
        return this.queryResults(this.queries.searchFunctions({ search, ...extraParams }));
    }
    return [];
  }

  private completionsCache: { [w: string]: NSDatabase.IStaticCompletion } = null;
  private dynamicCompletionsCache: { [w: string]: NSDatabase.IStaticCompletion } = null;
  private lastDynamicCompletionUpdate: number = 0;
  private readonly DYNAMIC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private async getDynamicCompletions(): Promise<{ [w: string]: NSDatabase.IStaticCompletion }> {
    const now = Date.now();
    if (this.dynamicCompletionsCache && (now - this.lastDynamicCompletionUpdate) < this.DYNAMIC_CACHE_TTL) {
      return this.dynamicCompletionsCache;
    }

    try {
      this.dynamicCompletionsCache = {};
      
      // Fetch all accessible projects, datasets, tables, and columns
      const databases = await this.queryResults(this.queries.fetchDatabases());
      
      for (const db of databases) {
        const dbKey = db.database;
        this.dynamicCompletionsCache[dbKey] = {
          label: dbKey,
          detail: 'Project',
          filterText: dbKey,
          sortText: '4:' + dbKey,
          documentation: {
            kind: 'markdown',
            value: `BigQuery Project: **${dbKey}**`
          }
        };

        // Fetch datasets for this project
        try {
          const schemas = await this.queryResults(this.queries.fetchSchemas(db));
          
          for (const schema of schemas) {
            const schemaKey = `${dbKey}.${schema.schema}`;
            this.dynamicCompletionsCache[schemaKey] = {
              label: schemaKey,
              detail: 'Dataset',
              filterText: schemaKey,
              sortText: '5:' + schemaKey,
              documentation: {
                kind: 'markdown',
                value: `BigQuery Dataset: **${schemaKey}**`
              }
            };

            // Fetch tables for this dataset
            try {
              const tables = await this.queryResults(this.queries.fetchTables(schema));
              
              for (const table of tables) {
                const tableKey = `${schemaKey}.${table.label}`;
                this.dynamicCompletionsCache[tableKey] = {
                  label: tableKey,
                  detail: 'Table',
                  filterText: tableKey,
                  sortText: '6:' + tableKey,
                  documentation: {
                    kind: 'markdown',
                    value: `BigQuery Table: **${tableKey}**`
                  }
                };
              }
            } catch (e) {
              // Continue even if we can't fetch tables for a specific dataset
            }
          }
        } catch (e) {
          // Continue even if we can't fetch schemas for a specific project
        }
      }

      this.lastDynamicCompletionUpdate = now;
    } catch (error) {
      // If we fail to fetch dynamic completions, return empty object
      this.dynamicCompletionsCache = {};
    }

    return this.dynamicCompletionsCache;
  }

  public getStaticCompletions: IConnectionDriver['getStaticCompletions'] = async () => {
    if (this.completionsCache) return this.completionsCache;
    
    this.completionsCache = {};
    
    // BigQuery SQL keywords
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
      'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'CROSS JOIN',
      'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
      'CREATE', 'TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'SCHEMA', 'DATABASE',
      'DROP', 'ALTER', 'TRUNCATE', 'REPLACE',
      'AS', 'ON', 'USING', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      'DISTINCT', 'ALL', 'ANY', 'EXISTS', 'NOT', 'NULL', 'IS', 'IN', 'LIKE',
      'BETWEEN', 'AND', 'OR', 'ASC', 'DESC',
      'UNION', 'INTERSECT', 'EXCEPT', 'UNNEST', 'ARRAY', 'STRUCT',
      'PARTITION BY', 'CLUSTER BY', 'OVER', 'WINDOW',
      'CAST', 'SAFE_CAST', 'EXTRACT', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP',
      'STRING', 'INT64', 'FLOAT64', 'BOOL', 'BYTES', 'NUMERIC', 'BIGNUMERIC',
      'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_DATETIME', 'CURRENT_TIMESTAMP'
    ];

    keywords.forEach(keyword => {
      const priority = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'].includes(keyword) ? '1:' : '2:';
      this.completionsCache[keyword] = {
        label: keyword,
        detail: keyword,
        filterText: keyword,
        sortText: priority + keyword,
        documentation: {
          kind: 'markdown',
          value: `\`\`\`sql\n${keyword}\n\`\`\`\nBigQuery SQL keyword`
        }
      };
    });

    // Add BigQuery-specific functions
    const functions = [
      // Aggregate functions
      { name: 'ARRAY_AGG', desc: 'Returns an ARRAY of values' },
      { name: 'ARRAY_CONCAT', desc: 'Concatenates arrays' },
      { name: 'ARRAY_LENGTH', desc: 'Returns the length of an array' },
      { name: 'ARRAY_TO_STRING', desc: 'Converts an array to a string' },
      { name: 'APPROX_COUNT_DISTINCT', desc: 'Returns the approximate count of distinct values' },
      { name: 'APPROX_QUANTILES', desc: 'Returns the approximate quantile boundaries' },
      { name: 'APPROX_TOP_COUNT', desc: 'Returns the approximate top elements' },
      { name: 'AVG', desc: 'Returns the average of non-NULL values' },
      { name: 'COUNT', desc: 'Returns the number of rows' },
      { name: 'MAX', desc: 'Returns the maximum value' },
      { name: 'MIN', desc: 'Returns the minimum value' },
      { name: 'SUM', desc: 'Returns the sum of non-NULL values' },
      { name: 'STRING_AGG', desc: 'Concatenates strings with a delimiter' },
      
      // Date/Time functions
      { name: 'CURRENT_DATE', desc: 'Returns the current date' },
      { name: 'CURRENT_DATETIME', desc: 'Returns the current datetime' },
      { name: 'CURRENT_TIME', desc: 'Returns the current time' },
      { name: 'CURRENT_TIMESTAMP', desc: 'Returns the current timestamp' },
      { name: 'DATE', desc: 'Constructs a DATE' },
      { name: 'DATE_ADD', desc: 'Adds a specified time interval to a DATE' },
      { name: 'DATE_DIFF', desc: 'Returns the difference between two dates' },
      { name: 'DATE_SUB', desc: 'Subtracts a specified time interval from a DATE' },
      { name: 'DATE_TRUNC', desc: 'Truncates a DATE to the specified granularity' },
      { name: 'DATETIME', desc: 'Constructs a DATETIME' },
      { name: 'EXTRACT', desc: 'Extracts part of a date/time' },
      { name: 'FORMAT_DATE', desc: 'Formats a DATE as a string' },
      { name: 'FORMAT_DATETIME', desc: 'Formats a DATETIME as a string' },
      { name: 'FORMAT_TIMESTAMP', desc: 'Formats a TIMESTAMP as a string' },
      { name: 'PARSE_DATE', desc: 'Parses a string into a DATE' },
      { name: 'PARSE_DATETIME', desc: 'Parses a string into a DATETIME' },
      { name: 'PARSE_TIMESTAMP', desc: 'Parses a string into a TIMESTAMP' },
      { name: 'TIMESTAMP', desc: 'Constructs a TIMESTAMP' },
      
      // String functions
      { name: 'CONCAT', desc: 'Concatenates strings' },
      { name: 'CONTAINS_SUBSTR', desc: 'Checks if a value contains a substring' },
      { name: 'ENDS_WITH', desc: 'Checks if a value ends with a substring' },
      { name: 'FORMAT', desc: 'Formats data according to a format string' },
      { name: 'LENGTH', desc: 'Returns the length of a string' },
      { name: 'LOWER', desc: 'Converts a string to lowercase' },
      { name: 'LPAD', desc: 'Pads a string on the left' },
      { name: 'LTRIM', desc: 'Removes leading whitespace' },
      { name: 'REGEXP_CONTAINS', desc: 'Checks if a string contains a regular expression match' },
      { name: 'REGEXP_EXTRACT', desc: 'Extracts a substring using a regular expression' },
      { name: 'REGEXP_REPLACE', desc: 'Replaces substrings using a regular expression' },
      { name: 'REPLACE', desc: 'Replaces all occurrences of a substring' },
      { name: 'REVERSE', desc: 'Reverses a string' },
      { name: 'RPAD', desc: 'Pads a string on the right' },
      { name: 'RTRIM', desc: 'Removes trailing whitespace' },
      { name: 'SPLIT', desc: 'Splits a string into an array' },
      { name: 'STARTS_WITH', desc: 'Checks if a value starts with a substring' },
      { name: 'SUBSTR', desc: 'Extracts a substring' },
      { name: 'TRIM', desc: 'Removes leading and trailing whitespace' },
      { name: 'UPPER', desc: 'Converts a string to uppercase' },
      
      // Math functions
      { name: 'ABS', desc: 'Returns the absolute value' },
      { name: 'ACOS', desc: 'Returns the arc cosine' },
      { name: 'ASIN', desc: 'Returns the arc sine' },
      { name: 'ATAN', desc: 'Returns the arc tangent' },
      { name: 'ATAN2', desc: 'Returns the arc tangent of two values' },
      { name: 'CEIL', desc: 'Returns the ceiling of a number' },
      { name: 'COS', desc: 'Returns the cosine' },
      { name: 'EXP', desc: 'Returns e raised to the power of X' },
      { name: 'FLOOR', desc: 'Returns the floor of a number' },
      { name: 'LN', desc: 'Returns the natural logarithm' },
      { name: 'LOG', desc: 'Returns the logarithm' },
      { name: 'LOG10', desc: 'Returns the base-10 logarithm' },
      { name: 'MOD', desc: 'Returns the modulo' },
      { name: 'POW', desc: 'Returns X raised to the power of Y' },
      { name: 'RAND', desc: 'Returns a random value' },
      { name: 'ROUND', desc: 'Rounds a number' },
      { name: 'SAFE_DIVIDE', desc: 'Performs division, returning NULL if division by zero' },
      { name: 'SIGN', desc: 'Returns the sign of a number' },
      { name: 'SIN', desc: 'Returns the sine' },
      { name: 'SQRT', desc: 'Returns the square root' },
      { name: 'TAN', desc: 'Returns the tangent' },
      { name: 'TRUNC', desc: 'Truncates a number' },
      
      // JSON functions
      { name: 'JSON_EXTRACT', desc: 'Extracts a value from a JSON string' },
      { name: 'JSON_EXTRACT_SCALAR', desc: 'Extracts a scalar value from a JSON string' },
      { name: 'JSON_EXTRACT_ARRAY', desc: 'Extracts an array from a JSON string' },
      { name: 'JSON_QUERY', desc: 'Extracts a JSON value' },
      { name: 'JSON_VALUE', desc: 'Extracts a scalar value from JSON' },
      { name: 'TO_JSON_STRING', desc: 'Converts a value to a JSON string' },
      
      // Geography functions
      { name: 'ST_AREA', desc: 'Returns the area of a geography' },
      { name: 'ST_ASBINARY', desc: 'Returns the WKB representation' },
      { name: 'ST_ASGEOJSON', desc: 'Returns the GeoJSON representation' },
      { name: 'ST_ASTEXT', desc: 'Returns the WKT representation' },
      { name: 'ST_BOUNDARY', desc: 'Returns the boundary of a geography' },
      { name: 'ST_BUFFER', desc: 'Returns a buffer around a geography' },
      { name: 'ST_CENTROID', desc: 'Returns the centroid of a geography' },
      { name: 'ST_CONTAINS', desc: 'Checks if one geography contains another' },
      { name: 'ST_DISTANCE', desc: 'Returns the distance between two geography values' },
      { name: 'ST_GEOGFROMGEOJSON', desc: 'Creates a geography from GeoJSON' },
      { name: 'ST_GEOGFROMTEXT', desc: 'Creates a geography from WKT' },
      { name: 'ST_GEOGFROMWKB', desc: 'Creates a geography from WKB' },
      { name: 'ST_GEOGPOINT', desc: 'Creates a geographic point' },
      { name: 'ST_INTERSECTION', desc: 'Returns the intersection of two geographies' },
      { name: 'ST_LENGTH', desc: 'Returns the length of a line' },
      { name: 'ST_UNION', desc: 'Returns the union of geographies' },
      { name: 'ST_WITHIN', desc: 'Checks if one geography is within another' },
      
      // Other functions
      { name: 'COALESCE', desc: 'Returns the first non-NULL expression' },
      { name: 'FARM_FINGERPRINT', desc: 'Computes the fingerprint of a STRING or BYTES value' },
      { name: 'GENERATE_UUID', desc: 'Generates a random UUID' },
      { name: 'GREATEST', desc: 'Returns the greatest value' },
      { name: 'IF', desc: 'Returns one of two values based on a condition' },
      { name: 'IFNULL', desc: 'Returns the first argument if not NULL, otherwise the second' },
      { name: 'LEAST', desc: 'Returns the least value' },
      { name: 'NULLIF', desc: 'Returns NULL if two expressions are equal' },
      { name: 'STRUCT', desc: 'Creates a STRUCT value' }
    ];

    functions.forEach(func => {
      this.completionsCache[func.name] = {
        label: func.name + '()',
        detail: func.name,
        filterText: func.name,
        sortText: '3:' + func.name,
        documentation: {
          kind: 'markdown',
          value: `\`\`\`sql\n${func.name}()\n\`\`\`\n${func.desc}`
        }
      };
    });

    // Merge static and dynamic completions
    const dynamicCompletions = await this.getDynamicCompletions();
    return { ...this.completionsCache, ...dynamicCompletions };
  }

}

