'use strict';

class MockshiftError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MockshiftError';
    this.status = options.status;
    this.body = options.body;
    this.cause = options.cause;
  }
}

class MockshiftConfigError extends MockshiftError {
  constructor(message) {
    super(message);
    this.name = 'MockshiftConfigError';
  }
}

// Backwards-compatible aliases (the package was previously named apihub-sdk).
const ApiHubError = MockshiftError;
const ApiHubConfigError = MockshiftConfigError;

module.exports = { MockshiftError, MockshiftConfigError, ApiHubError, ApiHubConfigError };
