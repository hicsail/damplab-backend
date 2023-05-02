import { Command, Flags } from '@oclif/core';

export default class GetExperiments extends Command {
  static flags = {
    project: Flags.string({
      description: 'The projectID to filter on',
      required: false
    }),
    study: Flags.string({
      description: 'The studyID to filter on',
      required: false
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { flags } = await this.parse(GetExperiments);

    // Make request to create the project
    const url = 'https://sandbox.elabjournal.com/api/v1/experiments';
    const result = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': key
      }
    });

    // If the result is not ok, do not continue
    if (result.status != 200) {
      console.log('Request failed');
      console.log(result);
    }
    const body = await result.json();

    let experiments: any = body.data;

    if (flags.project) {
      experiments = body.data.filter((experiment: any) => experiment.projectID == flags.project);
    }
    if (flags.study) {
      experiments = body.data.filter((experiment: any) => experiment.studyID == flags.study);
    }

    console.log(experiments);
  }
}
