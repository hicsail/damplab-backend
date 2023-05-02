import { Command, Flags } from '@oclif/core';

export default class CreateProject extends Command {
  static flags = {
    name: Flags.string({
      description: 'Name of the project',
      required: false,
    }),
    longname: Flags.string({
      description: 'Longer name of the project',
      required: false
    }),
    notes: Flags.string({
      description: 'Additional notes that may need to be provided',
      required: false
    }),
    label: Flags.string({
      description: 'Comma seperated list of labels',
      required: false
    }),
    projectMeta: Flags.string({
      description: 'JSON array with the string fields "name", "value", "metaType"',
      required: false
    })
  };

  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const { flags } = await this.parse(CreateProject);

    const requestBody: any = {
      ...flags
    };

    // Handle parsing labels
    if (requestBody.label) {
      requestBody.label = requestBody.label.split(',');
    }

    // Make request to create the project
    const url = 'https://sandbox.elabjournal.com/api/v1/projects';
    const result = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': key
      }
    });

    // Check the result
    if (result.status == 200) {
      const body = await result.json();
      console.log(body);
    } else {
      console.log('Request failed');
      console.log(result);
    }
  }
}
