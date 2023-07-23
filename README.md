[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# SQLTools BigQuery Driver

A Visual Studio Code extension that extends [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools), with a driver for Google BigQuery. 

This driver is maintained by [Evidence](https://evidence.dev): an open source BI tool to publish reports with SQL and Markdown.

![Connect DB](docs/images/connect-db.gif)

## Features

- Run queries on BiqQuery
- Explore datasets, tables and columns in the sidebar
- View table results by selecting them in the sidebar
- Completion for common keywords (e.g. SELECT, FROM, WHERE)


### Running a query

![Run Query](docs/images/run-query.gif)

### Exploring datasets, tables and columns

![Explore DB](docs/images/db-explorer.gif)

### Not Implemented

- Auto Completion tables and columns with Intellisense

## Connection Methods

Supports the following connection methods:
- Service Account
- GCloud CLI
- OAuth Access Token

For more details on the above connection methods see [connection guides](https://docs.evidence.dev/core-concepts/data-sources/#bigquery).

## ToDo
- Add BigQuery-specific keywords
- IntelliSense for table and column completion

## Maintained by [<img src="docs/images/evidence.png"  style="height:1em;"/>](https://www.evidence.dev)

Evidence is an open-source publishing tool for modern data teams, allowing you to build polished data products with just SQL and markdown.
- Star us on [GitHub](https://github.com/evidence-dev/evidence)
- Read our [Docs](https://docs.evidence.dev)
- Join us on [Slack](https://join.slack.com/t/evidencedev/shared_invite/zt-uda6wp6a-hP6Qyz0LUOddwpXW5qG03Q)


