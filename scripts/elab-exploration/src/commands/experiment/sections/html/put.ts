import { Args, Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';

export default class PutSectionHTML extends Command {
  static args = {
    journalID: Args.string({
      description: 'The expJournalID of the section to update the HTML for',
      required: true
    }),
    htmlFile: Args.string({
      description: 'The file to read the HTML from',
      required: true
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { args } = await this.parse(PutSectionHTML);

    const fileContents = await readFile(args.htmlFile, { encoding: 'utf-8' });

    const url = `https://sandbox.elabjournal.com/api/v1/experiments/sections/${args.journalID}/html`;
    const result = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': key
      },
      body: JSON.stringify({ html: fileContents })
    });

    if (result.status != 204) {
      console.log('Request failed');
      console.log(result);
      return;
    }

    console.log(result);
  }
}
