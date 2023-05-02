import { Command, Flags } from '@oclif/core';

export default class CreateStudy extends Command {
  async run(): Promise<void> {
    // Get the API key
    const key = process.env.ELAB_KEY;
    if (!key) {
      throw new Error('Requires environment variable ELAB_KEY');
    }
  }
}
