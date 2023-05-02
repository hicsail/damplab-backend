import { Args, Command } from '@oclif/core';

export default class GetSectionTable extends Command {
  static args = {
    journalID: Args.string({
      description: 'The expJournalID of the section to get the table from',
      required: true
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { args } = await this.parse(GetSectionTable);

    const url = `https://sandbox.elabjournal.com/api/v1/experiments/sections/${args.journalID}/datatable`;
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': key
      }
    });

    if (result.status != 200) {
      console.log('Request failed');
      console.log(result);
      return;
    }

    const body = await result.json();

    console.log(body);
  }
}
