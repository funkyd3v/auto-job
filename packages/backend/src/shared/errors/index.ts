export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(params: {
    code: string;
    message: string;
    statusCode?: number;
    isOperational?: boolean;
  }) {
    super(params.message);
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.isOperational = params.isOperational ?? true;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super({ code: 'BAD_REQUEST', message, statusCode: 400 });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super({ code: 'UNAUTHORIZED', message, statusCode: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super({ code: 'FORBIDDEN', message, statusCode: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super({ code: 'NOT_FOUND', message: `${resource} not found`, statusCode: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super({ code: 'CONFLICT', message, statusCode: 409 });
  }
}

export class DuplicateJobError extends ConflictError {
  constructor(jobId: string) {
    super(`Job already exists: ${jobId}`);
  }
}

export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>) {
    super({ code: 'VALIDATION_ERROR', message: 'Validation failed', statusCode: 422 });
    this.errors = errors;
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super({ code: 'RATE_LIMIT', message, statusCode: 429 });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super({ code: 'INTERNAL_ERROR', message, statusCode: 500, isOperational: false });
  }
}
