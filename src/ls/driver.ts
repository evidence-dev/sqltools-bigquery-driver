import AbstractDriver from '@sqltools/base-driver';
import { IConnectionDriver, NSDatabase } from '@sqltools/types';
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
}