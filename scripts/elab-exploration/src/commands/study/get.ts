import { Command, Flags } from '@oclif/core';

export default class GetStudies extends Command {
  static flags = {
    project: Flags.string({
      description: 'ID of the project to get studies for',
      required: false
    })
  }

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { flags } = await this.parse(GetStudies);

    const url = 'https://sandbox.elabjournal.com/api/v1/studies';
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': key
      }
    });

    // If request failed print error message
    if (result.status != 200) {
      console.log('Request failed');
      console.log(result);
      return;
    }
    const body = await result.json();

    let studies: any = body.data;

    if (flags.project) {
      studies = body.data.filter((study: any) => study.projectID == flags.project);
    }

    console.log(studies);
  }
}
