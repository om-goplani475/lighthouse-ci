/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/* eslint-env jest */

const fs = require('fs');
const os = require('os');
const path = require('path');
const StorageMethod = require('../../src/api/storage/storage-method.js');
const {createSeoStore} = require('../../src/seo/seo-store.js');
const {createSecretBox, PREFIX} = require('../../src/seo/secret-box.js');

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let storageMethod;
let dbPath;

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `seo-secrets-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const storage = {storageMethod: 'sql', sqlDialect: 'sqlite', sqlDatabasePath: dbPath};
  storageMethod = StorageMethod.from(storage);
  await storageMethod.initialize(storage);
});

afterEach(async () => {
  await storageMethod.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

const sequelize = () => storageMethod._sql().sequelize;
const raw = async sql => (await sequelize().query(sql))[0];

describe('secrets at rest', () => {
  it('stores the webhook secret and the notification config sealed, and reads them back', async () => {
    const store = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    const {secret} = await store.saveProject(ID, {provider: 'lhci'});
    await store.saveNotifications(ID, {slack: {url: 'https://hooks.slack.test/T/B/very-secret'}});

    const [project] = await raw('select webhookSecret from seo_projects');
    const [notes] = await raw('select config from seo_notifications');
    expect(project.webhookSecret.startsWith(PREFIX)).toBe(true);
    expect(project.webhookSecret).not.toContain(secret);
    expect(notes.config.startsWith(PREFIX)).toBe(true);
    expect(notes.config).not.toContain('very-secret');

    expect((await store.getProject(ID)).webhookSecret).toBe(secret);
    expect(await store.getNotifications(ID)).toEqual({
      slack: {url: 'https://hooks.slack.test/T/B/very-secret'},
    });
  });

  it("keeps today's behaviour with no key: plain text", async () => {
    const store = await createSeoStore(sequelize(), createSecretBox());
    const {secret} = await store.saveProject(ID, {provider: 'lhci'});
    const [project] = await raw('select webhookSecret from seo_projects');
    expect(project.webhookSecret).toBe(secret);
  });

  it('seals legacy plain rows at start-up, once', async () => {
    const plain = await createSeoStore(sequelize(), createSecretBox());
    const {secret} = await plain.saveProject(ID, {provider: 'lhci'});
    await plain.saveNotifications(ID, {slack: {url: 'https://hooks.slack.test/x'}});

    const store = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    expect(await store.sealStoredSecrets()).toBe(2);
    expect(await store.sealStoredSecrets()).toBe(0);
    const [project] = await raw('select webhookSecret from seo_projects');
    expect(project.webhookSecret.startsWith(PREFIX)).toBe(true);
    expect((await store.getProject(ID)).webhookSecret).toBe(secret);
  });

  it('rewrites values under the new key after a rotation', async () => {
    const a = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    const {secret} = await a.saveProject(ID, {provider: 'lhci'});
    const b = await createSeoStore(sequelize(), createSecretBox({key: KEY_B, previousKey: KEY_A}));
    expect(await b.sealStoredSecrets()).toBe(1);
    const onlyB = await createSeoStore(sequelize(), createSecretBox({key: KEY_B}));
    expect((await onlyB.getProject(ID)).webhookSecret).toBe(secret);
  });

  it('marks a project unreadable, never guesses, when the key is wrong or missing', async () => {
    const a = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    await a.saveProject(ID, {provider: 'lhci'});
    await a.saveNotifications(ID, {slack: {url: 'https://hooks.slack.test/x'}});

    for (const box of [createSecretBox({key: KEY_B}), createSecretBox()]) {
      const store = await createSeoStore(sequelize(), box);
      const project = await store.getProject(ID);
      expect(project).toMatchObject({webhookSecret: null, secretUnreadable: true});
      await expect(store.getNotifications(ID)).rejects.toThrow(/cannot be opened|not set/);
      expect(await store.sealStoredSecrets()).toBe(0);
    }
  });

  it("does not open one project's ciphertext as another's", async () => {
    const store = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    await store.saveProject(ID, {provider: 'lhci'});
    await store.saveProject(OTHER, {provider: 'lhci'});
    const [first] = await raw(`select webhookSecret from seo_projects where projectId = '${ID}'`);
    await sequelize().query(
      `update seo_projects set webhookSecret = '${first.webhookSecret}' where projectId = '${OTHER}'`
    );
    expect(await store.getProject(OTHER)).toMatchObject({secretUnreadable: true});
  });

  it('seals a rotated secret too', async () => {
    const store = await createSeoStore(sequelize(), createSecretBox({key: KEY_A}));
    const first = await store.saveProject(ID, {provider: 'lhci'});
    const second = await store.saveProject(ID, {}, {rotate: true});
    expect(second.secret).not.toBe(first.secret);
    const [project] = await raw('select webhookSecret from seo_projects');
    expect(project.webhookSecret.startsWith(PREFIX)).toBe(true);
    expect((await store.getProject(ID)).webhookSecret).toBe(second.secret);
  });
});
