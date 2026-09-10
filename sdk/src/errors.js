'use strict';

class ApiHubError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiHubError';
    this.status = options.status;
    this.body = options.body;
    this.cause = options.cause;
  }
}

class ApiHubConfigError extends ApiHubError {
  constructor(message) {
    super(message);
    this.name = 'ApiHubConfigError';
  }
}

module.exports = { ApiHubError, ApiHubConfigError };
