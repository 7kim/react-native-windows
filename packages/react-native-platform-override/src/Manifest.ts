/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 *
 * @format
 */

import * as Serialized from './Serialized';

import * as _ from 'lodash';

import Override, {deserializeOverride} from './Override';
import {OverrideFileRepository, ReactFileRepository} from './FileRepository';
import OverrideFactory from './OverrideFactory';
import {ValidationError} from './ValidationStrategy';

/**
 * Represents a collection of overrides listed in an on-disk manifest. Allows
 * performing aggregate operations on the overrides.
 */
export default class Manifest {
  private overrides: Array<Override>;

  constructor(overrides: Array<Override>) {
    const uniquelyNamed = _.uniqBy(overrides, ovr => ovr.name());
    if (uniquelyNamed.length !== overrides.length) {
      throw new Error('Cannot construct a manifest with duplicate overrides');
    }

    this.overrides = _.clone(overrides);
  }

  static fromSerialized(man: Serialized.Manifest): Manifest {
    const overrides = man.overrides.map(deserializeOverride);
    return new Manifest(overrides);
  }

  /**
   * Check that overrides are accurately accounted for in the manifest. E.g.
   * all files should be accounted for, and base files should be up to date
   * with upstream.
   */
  async validate(
    overrideRepo: OverrideFileRepository,
    reactRepo: ReactFileRepository,
  ): Promise<Array<ValidationError>> {
    const errors: ValidationError[] = [];

    const overrideFiles = await overrideRepo.listFiles();
    const missingFromManifest = overrideFiles.filter(
      file => !this.overrides.some(override => override.includesFile(file)),
    );

    for (const missingFile of missingFromManifest) {
      errors.push({type: 'missingFromManifest', overrideName: missingFile});
    }

    const validationTasks = _.flatMap(this.overrides, ovr =>
      ovr.validationStrategies(),
    );

    for (const task of validationTasks) {
      errors.push(...(await task.validate(overrideRepo, reactRepo)));
    }

    return errors;
  }

  /**
   * Add an override to the manifest
   */
  addOverride(override: Override) {
    if (this.hasOverride(override.name())) {
      throw new Error(`Trying to add duplicate override '${override.name()}'`);
    }

    this.overrides.push(override);
  }

  /**
   * Whether the manifest contains a given override
   */
  hasOverride(overrideName: string): boolean {
    return this.overrides.some(ovr => ovr.name() === overrideName);
  }

  /**
   * Try to remove an override.
   * @returns false if none is found with the given name
   */
  removeOverride(overrideName: string): boolean {
    const idx = this.findOverrideIndex(overrideName);
    if (idx === -1) {
      return false;
    }

    this.overrides.splice(idx, 1);
    return true;
  }

  /**
   * Returns the entry corresponding to the given override path, or null if none
   * exists.
   */
  findOverride(overrideName: string): Override | null {
    const idx = this.findOverrideIndex(overrideName);
    if (idx === -1) {
      return null;
    }

    return this.overrides[idx];
  }

  /**
   * Updates an override entry to mark it as up-to-date in regards to its
   * current base file.
   */
  async markUpToDate(overrideName: string, overrideFactory: OverrideFactory) {
    const override = this.findOverride(overrideName);
    if (override === null) {
      throw new Error(`Override '${overrideName}' does not exist`);
    }

    // Mutate the object instead of replacing by index because the index may no
    // longer be the same after awaiting.
    const upToDateOverride = await override.createUpdated(overrideFactory);
    Object.assign(override, upToDateOverride);
  }

  /**
   * Return a serialized representation of the manifest
   */
  serialize(): Serialized.Manifest {
    return {
      overrides: this.overrides
        .sort((a, b) => a.name().localeCompare(b.name(), 'en'))
        .map(override => override.serialize()),
    };
  }

  /**
   * Find the index to a given override.
   * @returns -1 if it cannot be found
   */
  private findOverrideIndex(overrideName: string): number {
    return this.overrides.findIndex(ovr => ovr.name() === overrideName);
  }
}
