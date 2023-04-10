import { Command } from '@oclif/core';

export default class Project extends Command {
  async run(): Promise<void> {
    console.log('hello there');
  }
}
