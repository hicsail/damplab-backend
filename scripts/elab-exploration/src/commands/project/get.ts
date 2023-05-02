import { Command } from '@oclif/core';

export default class GetProjects extends Command {
  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }

    const url = 'https://sandbox.elabjournal.com/api/v1/projects';
    const result = await fetch(url, {
      method: 'GET',
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
