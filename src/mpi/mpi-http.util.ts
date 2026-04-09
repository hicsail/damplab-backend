import { HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

const MAX_MESSAGE_LEN = 500;

function pickSafeMessage(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const o = data as Record<string, unknown>;
  const candidates = [
    o.message,
    o.error_description,
    o.error,
    o.detail,
    o.title
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
  }
  return undefined;
}

/**
 * Maps MPI / Auth0 HTTP errors to HttpException with a bounded, client-safe message.
 */
export function httpExceptionFromMpiAxiosError(error: unknown, fallbackMessage: string): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const picked = pickSafeMessage(error.response?.data);
    let message = picked || fallbackMessage;
    if (message.length > MAX_MESSAGE_LEN) {
      message = `${message.slice(0, MAX_MESSAGE_LEN - 3)}...`;
    }

    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      return new HttpException(message, status);
    }
    if (status === HttpStatus.NOT_FOUND) {
      return new HttpException(message, HttpStatus.NOT_FOUND);
    }
    if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
      return new HttpException(message, HttpStatus.BAD_REQUEST);
    }
    if (status === HttpStatus.CONFLICT) {
      return new HttpException(message, HttpStatus.CONFLICT);
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return new HttpException(message, status);
    }
    if (status !== undefined && status >= 500) {
      return new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
    return new HttpException(message, HttpStatus.BAD_GATEWAY);
  }

  return new HttpException(fallbackMessage, HttpStatus.INTERNAL_SERVER_ERROR);
}
