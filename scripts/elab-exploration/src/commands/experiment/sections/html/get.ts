import { Args, Command, Flags } from '@oclif/core';

export default class GetSectionHTML extends Command {
  static args = {
    journalID: Args.string({
      description: 'The expJournalID of the section to get the HTML for',
      required: true
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { args } = await this.parse(GetSectionHTML);

    const url = `https://sandbox.elabjournal.com/api/v1/experiments/sections/${args.journalID}/html`;
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': key
      }
    });

    if (result.status != 200) {
      console.log('Request failed');
      console.log(result);
    }
    const body = await result.text();
    console.log(body);
  }
}
