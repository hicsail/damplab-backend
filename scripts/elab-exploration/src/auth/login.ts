import { Args, Command } from '@oclif/core';

export default class Login extends Command {

  static args = {
    credentials: Args.string({
      name: 'credentials',
      required: true,
      description: 'Env file containing USER and PASSWORD'
    })
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Login);

    console.log(args);
  }
}
