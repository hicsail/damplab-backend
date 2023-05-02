import { Args, Command } from '@oclif/core';
import { readFile } from 'fs/promises';

export default class PutSectionTable extends Command {
  static args = {
    journalID: Args.string({
      description: 'The expJournalID of the section to update the table for',
      required: true
    }),
    tableFile: Args.string({
      description: 'The file to read the table from',
      required: true
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { args } = await this.parse(PutSectionTable);

    const fileContents = await readFile(args.tableFile, { encoding: 'utf-8' });
    console.log(fileContents);

    const url = `https://sandbox.elabjournal.com/api/v1/experiments/sections/${args.journalID}/datatable`;
    const result = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': key,
        'Content-Type': 'application/json'
      },
      body: fileContents
    });

    if (result.status != 204) {
      console.log('Request failed');
      console.log(result);
      return;
    }

    console.log(result);
  }
}
