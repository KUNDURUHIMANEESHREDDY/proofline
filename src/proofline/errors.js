export class StoreConflictError extends Error {
  constructor(message = 'record already exists') {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreBusyError extends Error {
  constructor(message = 'store is temporarily busy') {
    super(message);
    this.name = 'StoreBusyError';
  }
}
