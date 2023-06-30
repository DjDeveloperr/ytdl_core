export class Cache extends Map {
  constructor(public timeout = 1000) {
    super();
  }

  set(key: string, value: any) {
    if (this.has(key)) {
      clearTimeout(super.get(key).tid);
    }

    super.set(key, {
      tid: setTimeout(this.delete.bind(this, key), this.timeout),
      value,
    });

    return this;
  }

  get(key: string) {
    let entry = super.get(key);
    if (entry) {
      return entry.value;
    }
    return null;
  }

  getOrSet(key: string, fn: CallableFunction) {
    if (this.has(key)) {
      return this.get(key);
    } else {
      let value = fn();
      this.set(key, value);
      (async () => {
        try {
          await value;
        } catch (err) {
          this.delete(key);
        }
      })();
      return value;
    }
  }

  delete(key: string) {
    let entry = super.get(key);
    if (entry) {
      clearTimeout(entry.tid);
      return super.delete(key);
    } else return false;
  }

  clear() {
    for (let entry of this.values()) {
      clearTimeout(entry.tid);
    }
    super.clear();
  }
}
