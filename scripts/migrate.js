import { readCms } from "../src/lib/cmsStore.js";
import { supabaseAdmin } from "../src/lib/supabase.js";

async function runMigration() {
  console.log("Iniciando migracao do cms.json para o Supabase...");
  
  try {
    const data = await readCms();

    if (data.categories && data.categories.length > 0) {
      console.log(`Migrando ${data.categories.length} categorias...`);
      const { error } = await supabaseAdmin.from("categories").upsert(data.categories, { onConflict: 'id' });
      if (error) throw error;
    }

    if (data.products && data.products.length > 0) {
      console.log(`Migrando ${data.products.length} produtos...`);
      const { error } = await supabaseAdmin.from("products").upsert(data.products, { onConflict: 'id' });
      if (error) throw error;
    }

    if (data.settings) {
      console.log(`Migrando configuracoes...`);
      const { error } = await supabaseAdmin.from("settings").upsert({ id: 1, ...data.settings }, { onConflict: 'id' });
      if (error) throw error;
    }

    if (data.orders && data.orders.length > 0) {
      console.log(`Migrando ${data.orders.length} pedidos...`);
      const { error } = await supabaseAdmin.from("orders").upsert(data.orders, { onConflict: 'id' });
      if (error) throw error;
    }

    if (data.metrics) {
      console.log(`Migrando metricas...`);
      const { error } = await supabaseAdmin.from("metrics").upsert({ id: 1, ...data.metrics }, { onConflict: 'id' });
      if (error) throw error;
    }

    console.log("✅ Migracao concluida com sucesso!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro durante a migracao:", err);
    process.exit(1);
  }
}

runMigration();
