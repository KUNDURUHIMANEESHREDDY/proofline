export class StoreConflictError extends Error {
  constructor(message = 'record already exists') {
    super(message);
    this.name = 'StoreConflictError';
  }
}
