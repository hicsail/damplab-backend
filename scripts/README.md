# DampLab Backend Scripts

## Introduction

These scripts are intended for development purpose and thus are expected to
change rapidly. The scripts are used as tools to make testing in development
easier. They complete tasks such as clearing out the database, loaded different
pieces of data into the database, adding pieces of data manually, etc.

> :warning:
> 1. Do not treat these scripts as stable
> 2. The scripts do not follow the same constraints as the rest of the code
>    base and therefore developers should not rely on the safety of the types
>    being added into the database
> 3. The scripts are not guaranteed to be kept up-to-date with the rest of
>    the code base.

## Usage

From this directory, run
```
npm install
npm run build
```
Then run commands using `./bin/dev` (dev mode) or `./bin/run` (run mode). For example: `./bin/dev --help` <!-- why is `load` under TOPICS and `reset` under COMMANDS?? -->, `./bin/run reset`, `./bin/dev load all [-d <database_url>]`.

## Initializing database

To populate your test database with data, you can run `npm run initdb` from the root of this project, and that will run the `load all` script for you. If your database is not at the default `mongodb://localhost:27017/damplab`, you can pass its url to the script like so: `npm run initdb -- -d <your_db_url_here>`.
