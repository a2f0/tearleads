/**
 * Shared nested transaction manager for adapter implementations.
 *
 * Root transaction lifecycle is delegated to the driver. Nested transactions
 * are implemented with SAVEPOINT/RELEASE/ROLLBACK TO so callers can safely
 * compose begin/commit/rollback calls.
 */

interface TransactionDriver {
  beginRoot(): Promise<void>;
  commitRoot(): Promise<void>;
  rollbackRoot(): Promise<void>;
  executeSql(sql: string): Promise<void>;
  isRootTransactionActive?(): Promise<boolean>;
}

function noActiveTransactionError(action: 'commit' | 'rollback'): Error {
  return new Error(`No active transaction to ${action}`);
}

export class SavepointTransactionManager {
  private nestedSavepoints: string[] = [];
  private rootTransactionStarted = false;

  constructor(
    private readonly driver: TransactionDriver,
    private readonly savepointPrefix: string
  ) {}

  async begin(): Promise<void> {
    if (this.nestedSavepoints.length > 0) {
      await this.beginNestedSavepoint();
      return;
    }

    if (this.rootTransactionStarted || (await this.isRootActive())) {
      await this.beginNestedSavepoint();
      return;
    }

    await this.driver.beginRoot();
    this.rootTransactionStarted = true;
  }

  async commit(): Promise<void> {
    const savepoint = this.nestedSavepoints.pop();
    if (savepoint) {
      await this.driver.executeSql(`RELEASE ${savepoint}`);
      return;
    }

    if (!this.rootTransactionStarted && !(await this.isRootActive())) {
      throw noActiveTransactionError('commit');
    }

    await this.driver.commitRoot();
    this.rootTransactionStarted = false;
  }

  async rollback(): Promise<void> {
    const savepoint = this.nestedSavepoints.pop();
    if (savepoint) {
      await this.driver.executeSql(`ROLLBACK TO ${savepoint}`);
      await this.driver.executeSql(`RELEASE ${savepoint}`);
      return;
    }

    if (!this.rootTransactionStarted && !(await this.isRootActive())) {
      throw noActiveTransactionError('rollback');
    }

    await this.driver.rollbackRoot();
    this.rootTransactionStarted = false;
  }

  reset(): void {
    this.nestedSavepoints = [];
    this.rootTransactionStarted = false;
  }

  private async isRootActive(): Promise<boolean> {
    if (!this.driver.isRootTransactionActive) {
      return false;
    }
    return this.driver.isRootTransactionActive();
  }

  private async beginNestedSavepoint(): Promise<void> {
    const savepoint = `${this.savepointPrefix}_${this.nestedSavepoints.length + 1}`;
    await this.driver.executeSql(`SAVEPOINT ${savepoint}`);
    this.nestedSavepoints.push(savepoint);
  }
}
