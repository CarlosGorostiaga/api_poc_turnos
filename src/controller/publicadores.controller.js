const db = require("../database");

// Listar todos los publicadores
const getAll = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id,
             p.nombre,
             p.tipo,
             p.pareja_id,
             p.tutor_id,
             p.activo,
             p.created_at,
             p.updated_at,
             pareja.nombre as pareja_nombre,
             tutor.nombre as tutor_nombre
      FROM publicadores p
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      LEFT JOIN publicadores tutor ON p.tutor_id = tutor.id
      ORDER BY p.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener un publicador por ID
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `
      SELECT p.id,
             p.nombre,
             p.tipo,
             p.pareja_id,
             p.tutor_id,
             p.activo,
             p.created_at,
             p.updated_at,
             pareja.nombre as pareja_nombre,
             tutor.nombre as tutor_nombre
      FROM publicadores p
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      LEFT JOIN publicadores tutor ON p.tutor_id = tutor.id
      WHERE p.id = $1
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicador no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Crear publicador
const create = async (req, res) => {
  try {
    const { nombre, tipo, pareja_id, tutor_id, activo } = req.body;

    // Validaciones básicas
    if (!nombre || nombre.trim() === "") {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    // Validar tipo permitido
    const tiposPermitidos = ["solo", "matrimonio", "menor"];
    const tipoFinal = tipo && tiposPermitidos.includes(tipo) ? tipo : "solo";

    const result = await db.query(
      `
      INSERT INTO publicadores (nombre, tipo, pareja_id, tutor_id, activo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
      [
        nombre.trim(),
        tipoFinal,
        pareja_id || null,
        tutor_id || null,
        activo !== false,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Actualizar publicador
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, pareja_id, tutor_id, activo } = req.body;

    const result = await db.query(
      `
      UPDATE publicadores 
      SET nombre = COALESCE($1, nombre),
          tipo = COALESCE($2, tipo),
          pareja_id = $3,
          tutor_id = $4,
          activo = COALESCE($5, activo),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `,
      [nombre, tipo, pareja_id, tutor_id, activo, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicador no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Eliminar publicador
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM publicadores WHERE id = $1 RETURNING *",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Publicador no encontrado" });
    }
    res.json({ message: "Publicador eliminado", publicador: result.rows[0] });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Casar dos publicadores (actualizar pareja_id mutuamente y tipo a 'matrimonio')
const casarPublicadores = async (req, res) => {
  const client = await db.connect();

  try {
    const { publicador1_id, publicador2_id } = req.body;

    // Validaciones
    if (!publicador1_id || !publicador2_id) {
      return res
        .status(400)
        .json({ error: "Se requieren ambos IDs de publicadores" });
    }

    if (publicador1_id === publicador2_id) {
      return res
        .status(400)
        .json({ error: "No se puede casar un publicador consigo mismo" });
    }

    await client.query("BEGIN");

    // Verificar que ambos existen
    const check1 = await client.query(
      "SELECT * FROM publicadores WHERE id = $1",
      [publicador1_id],
    );
    const check2 = await client.query(
      "SELECT * FROM publicadores WHERE id = $1",
      [publicador2_id],
    );

    if (check1.rows.length === 0 || check2.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Uno o ambos publicadores no existen" });
    }

    // Actualizar tipo a 'matrimonio' y asignar pareja_id mutuamente
    await client.query(
      `
      UPDATE publicadores 
      SET tipo = 'matrimonio', 
          pareja_id = $2, 
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [publicador1_id, publicador2_id],
    );

    await client.query(
      `
      UPDATE publicadores 
      SET tipo = 'matrimonio', 
          pareja_id = $2, 
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [publicador2_id, publicador1_id],
    );

    await client.query("COMMIT");

    // Obtener resultado final
    const result = await client.query(
      `
      SELECT p.*, pareja.nombre as pareja_nombre
      FROM publicadores p
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      WHERE p.id IN ($1, $2)
    `,
      [publicador1_id, publicador2_id],
    );

    res.json({
      message: "Publicadores casados exitosamente",
      publicadores: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  casarPublicadores,
};
