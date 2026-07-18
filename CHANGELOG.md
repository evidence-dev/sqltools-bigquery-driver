# Changelog

## 0.0.10
- Added `disablePagination` connection setting to turn off the new query-pagination behavior entirely and go back to fetching the full result set in one call
- Added `disablePaginationCount` connection setting to skip the exact `COUNT(1)` query and always show an estimated total instead
- Fixed a bug where moving from page 1 to page 2 of a paginated result opened a new results tab while the original tab was left stuck on a loading spinner (subsequent page changes were unaffected). Cause: a fresh random `resultId` was generated for every page; it's now generated once per query run and kept stable across all of its pages
- Console `SELECT`/`WITH` queries now support pagination (`LIMIT n+1 OFFSET m`), with an exact row total via a `COUNT(1)` wrapper subquery (falling back to a look-ahead estimate), cached per query/run to avoid re-counting on every page turn
- Added `previewLimit` connection setting used as the default page size
- Added `connectionInitSql` connection setting: SQL executed once in a BigQuery session (`createSession: true`) right after the connection opens; the resulting `session_id` is reused on subsequent queries; failure aborts the connection
- No-result DML/DDL statements (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/`CREATE`/`DROP`/`ALTER`/...) now show a one-row `Statement`/`Result` grid instead of a blank "No rows returned" grid; empty `SELECT`s are unaffected
- Internal metadata/explorer/"Show Records" queries are now tagged and excluded from the new pagination logic so they aren't truncated to the page size

## 0.0.9 
- Adds support for ARRAY results
- Upgrades BigQuery (@google-cloud/bigquery) to 7.9.0

## 0.0.8
- Fix published artifact

## 0.0.7
- Sort datasets and schemas alpahbetically in the explorer

## 0.0.6
- Fix Readme images

## 0.0.5
- View stored procedures, UDFs and table functions in the explorer
- Fix describeTable command
- Add icons for data types in the explorer
- Smaller extension size (10MB -> 150KB)

## 0.0.4
- Adds support for data in non-US regions

## 0.0.3
- Fixes bug where queries returning zero rows throw an error

## 0.0.2
- Fixes bugs with sidebar explorer
- Implements ability to view table results from explorer
- Adds GCloud CLI and OAuth Access Token as options for authentication
- Cleans up Connection UI

## 0.0.1
- Initial release