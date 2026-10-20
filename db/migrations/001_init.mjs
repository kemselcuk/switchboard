export async function up(db) {
  await db.schema
    .createTable('projects')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('key', 'text', (column) => column.notNull().unique())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('environments')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('project_id', 'text', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('environments_project_key_unique', [
      'project_id',
      'key',
    ])
    .addForeignKeyConstraint(
      'environments_project_fk',
      ['project_id'],
      'projects',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('flags')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('project_id', 'text', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull().defaultTo('boolean'))
    .addColumn('description', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('flags_project_key_unique', ['project_id', 'key'])
    .addForeignKeyConstraint(
      'flags_project_fk',
      ['project_id'],
      'projects',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('flag_configs')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('flag_id', 'text', (column) => column.notNull())
    .addColumn('environment_id', 'text', (column) => column.notNull())
    .addColumn('enabled', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('rollout_basis_points', 'integer', (column) =>
      column.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('flag_configs_flag_environment_unique', [
      'flag_id',
      'environment_id',
    ])
    .addForeignKeyConstraint(
      'flag_configs_flag_fk',
      ['flag_id'],
      'flags',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'flag_configs_environment_fk',
      ['environment_id'],
      'environments',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('api_keys')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('environment_id', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull().defaultTo('server'))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('prefix', 'text', (column) => column.notNull().unique())
    .addColumn('hash', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('last_used_at', 'text')
    .addColumn('revoked_at', 'text')
    .addForeignKeyConstraint(
      'api_keys_environment_fk',
      ['environment_id'],
      'environments',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('environments_project_idx')
    .on('environments')
    .column('project_id')
    .execute();

  await db.schema
    .createIndex('flags_project_idx')
    .on('flags')
    .column('project_id')
    .execute();

  await db.schema
    .createIndex('flag_configs_environment_idx')
    .on('flag_configs')
    .column('environment_id')
    .execute();

  await db.schema
    .createIndex('api_keys_prefix_idx')
    .on('api_keys')
    .column('prefix')
    .execute();
}

export async function down(db) {
  await db.schema.dropTable('api_keys').ifExists().execute();
  await db.schema.dropTable('flag_configs').ifExists().execute();
  await db.schema.dropTable('flags').ifExists().execute();
  await db.schema.dropTable('environments').ifExists().execute();
  await db.schema.dropTable('projects').ifExists().execute();
}
