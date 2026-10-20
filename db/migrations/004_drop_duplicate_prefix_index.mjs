export async function up(db) {
  await db.schema.dropIndex('api_keys_prefix_idx').ifExists().execute();
}

export async function down(db) {
  await db.schema
    .createIndex('api_keys_prefix_idx')
    .on('api_keys')
    .column('prefix')
    .execute();
}
