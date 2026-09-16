import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ValidationError } from '../errors/index.js';
import type { ZodError } from 'zod';

export function handleError(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = request.log;

  // Zod validation error
  if (error.name === 'ZodError' && 'issues' in error) {
    const zodError = error as ZodError;
    const errors: Record<string, string[]> = {};
    zodError.issues.forEach((issue) => {
      const path = issue.path.join('.');
      if (!errors[path]) errors[path] = [];
      errors[path].push(issue.message);
    });
    const validationError = new ValidationError(errors);
    logger.warn({ err: validationError, requestId: request.id }, 'Validation failed');
    return reply.status(422).send({
      error: 'Validation Error',
      message: validationError.message,
      code: validationError.code,
      details: errors,
    });
  }

  // Custom application error
  if (error instanceof AppError) {
    if (error.isOperational) {
      logger.warn({ err: error, requestId: request.id }, error.message);
    } else {
      logger.error({ err: error, requestId: request.id }, error.message);
    }
    return reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
      code: error.code,
    });
  }

  // Fastify error
  if ('statusCode' in error) {
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;
    logger.error({ err: fastifyError, requestId: request.id }, fastifyError.message);
    return reply.status(statusCode).send({
      error: 'Error',
      message: fastifyError.message,
      code: fastifyError.code,
    });
  }

  // Unknown error
  logger.error({ err: error, requestId: request.id }, 'Unhandled error');
  return reply.status(500).send({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  });
}
