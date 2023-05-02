import { Command, Args } from '@oclif/core';

export default class GetSections extends Command {
  static args = {
    experiment: Args.string({
      description: 'The experiment to get the sections for',
      required: true
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { args } = await this.parse(GetSections);

    const url = `https://sandbox.elabjournal.com/api/v1/experiments/${args.experiment}/sections`;
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
