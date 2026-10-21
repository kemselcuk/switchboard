export async function up(db) {
  await db.schema
    .alterTable('flag_configs')
    .addColumn('on_value', 'text')
    .execute();

  await db.schema
    .alterTable('flag_configs')
    .addColumn('off_value', 'text')
    .execute();
}

export async function down(db) {
  await db.schema
    .alterTable('flag_configs')
    .dropColumn('off_value')
    .execute();

  await db.schema
    .alterTable('flag_configs')
    .dropColumn('on_value')
    .execute();
}
