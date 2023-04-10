import { Args, Command } from '@oclif/core';
import * as dotenv from 'dotenv';

export default class Login extends Command {

  static args = {
    credentials: Args.string({
      name: 'credentials',
      required: true,
      description: `Env file containing the following
        1. ELAB_USER
        2. ELAB_PASSWORD
      `
    })
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Login);

    dotenv.config({ path: args.credentials });

    const url = 'https://sandbox.elabjournal.com/api/v1/auth/user';
    const body = {
      username: process.env.ELAB_USER,
      password: process.env.ELAB_PASSWORD
    };

    const result = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (result.status == 200) {
      const body = await result.json();
      console.log(`API Key: ${body.token}`);
    } else {
      console.log('Request failed');
      console.log(result);
    }
  }
}
