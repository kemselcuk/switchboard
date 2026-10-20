import { sql } from 'kysely';

const ENABLED_CHECK = 'flag_configs_enabled_check';
const ROLLOUT_CHECK = 'flag_configs_rollout_check';

function isSqlite(db) {
  return db
    .getExecutor()
    .adapter
    .constructor
    .name
    .toLowerCase()
    .includes('sqlite');
}

async function rebuildSqlite(db, { withChecks }) {
  const temporary = 'flag_configs_rebuild';

  await db.schema.dropTable(temporary).ifExists().execute();

  let table = db.schema
    .createTable(temporary)
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('flag_id', 'text', (column) => column.notNull())
    .addColumn('environment_id', 'text', (column) => column.notNull())
    .addColumn('enabled', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('rollout_basis_points', 'integer', (column) =>
      column.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('flag_configs_rebuild_flag_environment_unique', [
      'flag_id',
      'environment_id',
    ])
    .addForeignKeyConstraint(
      'flag_configs_rebuild_flag_fk',
      ['flag_id'],
      'flags',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'flag_configs_rebuild_environment_fk',
      ['environment_id'],
      'environments',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    );

  if (withChecks) {
    table = table
      .addCheckConstraint(
        'flag_configs_rebuild_enabled_check',
        sql`enabled in (0, 1)`,
      )
      .addCheckConstraint(
        'flag_configs_rebuild_rollout_check',
        sql`rollout_basis_points between 0 and 100000`,
      );
  }

  await table.execute();

  await sql`
    insert into ${sql.table(temporary)} (
      id,
      flag_id,
      environment_id,
      enabled,
      rollout_basis_points,
      created_at,
      updated_at
    )
    select
      id,
      flag_id,
      environment_id,
      enabled,
      rollout_basis_points,
      created_at,
      updated_at
    from ${sql.table('flag_configs')}
  `.execute(db);

  await db.schema.dropTable('flag_configs').execute();
  await db.schema.alterTable(temporary).renameTo('flag_configs').execute();
  await db.schema
    .createIndex('flag_configs_environment_idx')
    .on('flag_configs')
    .column('environment_id')
    .execute();
}

export async function up(db) {
  if (isSqlite(db)) {
    await rebuildSqlite(db, { withChecks: true });
    return;
  }

  await sql`
    alter table flag_configs
    add constraint ${sql.ref(ENABLED_CHECK)}
    check (enabled in (0, 1))
  `.execute(db);
  await sql`
    alter table flag_configs
    add constraint ${sql.ref(ROLLOUT_CHECK)}
    check (rollout_basis_points between 0 and 100000)
  `.execute(db);
}

export async function down(db) {
  if (isSqlite(db)) {
    await rebuildSqlite(db, { withChecks: false });
    return;
  }

  await sql`
    alter table flag_configs
    drop constraint if exists ${sql.ref(ENABLED_CHECK)}
  `.execute(db);
  await sql`
    alter table flag_configs
    drop constraint if exists ${sql.ref(ROLLOUT_CHECK)}
  `.execute(db);
}
