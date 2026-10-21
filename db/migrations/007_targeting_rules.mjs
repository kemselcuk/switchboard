import { sql } from 'kysely';

export async function up(db) {
  await db.schema
    .createTable('segments')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('project_id', 'text', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('conditions', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('segments_project_key_unique', ['project_id', 'key'])
    .addForeignKeyConstraint(
      'segments_project_fk',
      ['project_id'],
      'projects',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createTable('flag_rules')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('flag_id', 'text', (column) => column.notNull())
    .addColumn('environment_id', 'text', (column) => column.notNull())
    .addColumn('position', 'integer', (column) => column.notNull())
    .addColumn('segment_id', 'text')
    .addColumn('conditions', 'text')
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'text', (column) => column.notNull())
    .addUniqueConstraint('flag_rules_flag_environment_position_unique', [
      'flag_id',
      'environment_id',
      'position',
    ])
    .addCheckConstraint(
      'flag_rules_target_check',
      sql`(segment_id is not null and conditions is null)
        or (segment_id is null and conditions is not null)`,
    )
    .addCheckConstraint(
      'flag_rules_action_check',
      sql`action in ('on', 'off')`,
    )
    .addCheckConstraint(
      'flag_rules_position_check',
      sql`position >= 0`,
    )
    .addForeignKeyConstraint(
      'flag_rules_flag_fk',
      ['flag_id'],
      'flags',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'flag_rules_environment_fk',
      ['environment_id'],
      'environments',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'flag_rules_segment_fk',
      ['segment_id'],
      'segments',
      ['id'],
      (constraint) => constraint.onDelete('restrict'),
    )
    .execute();

  await db.schema
    .createIndex('segments_project_idx')
    .on('segments')
    .column('project_id')
    .execute();

  await db.schema
    .createIndex('flag_rules_environment_idx')
    .on('flag_rules')
    .column('environment_id')
    .execute();

  await db.schema
    .createIndex('flag_rules_segment_idx')
    .on('flag_rules')
    .column('segment_id')
    .execute();
}

export async function down(db) {
  await db.schema.dropTable('flag_rules').ifExists().execute();
  await db.schema.dropTable('segments').ifExists().execute();
}
