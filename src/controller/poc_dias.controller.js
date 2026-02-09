const db = require("../database");

// Listar todos los días POC
const getAll = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pd.*,
             COUNT(pt.id) as total_turnos
      FROM poc_dia pd
      LEFT JOIN poc_turnos pt ON pt.poc_dia_id = pd.id
      GROUP BY pd.id
      ORDER BY pd.fecha DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener un día POC por ID con sus turnos
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const diaResult = await db.query("SELECT * FROM poc_dia WHERE id = $1", [
      id,
    ]);

    if (diaResult.rows.length === 0) {
      return res.status(404).json({ error: "Día POC no encontrado" });
    }

    const turnosResult = await db.query(
      `
      SELECT * FROM poc_turnos 
      WHERE poc_dia_id = $1
      ORDER BY turno
    `,
      [id],
    );

    res.json({
      dia: diaResult.rows[0],
      turnos: turnosResult.rows,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Crear un día POC con sus turnos
const create = async (req, res) => {
  const client = await db.connect();

  try {
    const { fecha, ubicacion, turnos } = req.body;

    // turnos: [
    //   { turno: "mañana", capacidad: 3 },
    //   { turno: "tarde", capacidad: 3 }
    // ]

    if (!fecha || !ubicacion) {
      return res.status(400).json({
        error: "Se requieren fecha y ubicación",
      });
    }

    await client.query("BEGIN");

    // Crear el día POC
    const diaResult = await client.query(
      `
      INSERT INTO poc_dia (fecha, ubicacion)
      VALUES ($1, $2)
      RETURNING *
    `,
      [fecha, ubicacion],
    );

    const pocDiaId = diaResult.rows[0].id;

    // Crear turnos si se proporcionan
    const turnosCreados = [];
    if (turnos && turnos.length > 0) {
      for (const turno of turnos) {
        const turnoResult = await client.query(
          `
          INSERT INTO poc_turnos (poc_dia_id, turno, capacidad)
          VALUES ($1, $2, $3)
          RETURNING *
        `,
          [pocDiaId, turno.turno, turno.capacidad || 3], // ← CAMBIO AQUÍ: de 4 a 3
        );

        turnosCreados.push(turnoResult.rows[0]);
      }
    }

    await client.query("COMMIT");

    res.status(201).json({
      dia: diaResult.rows[0],
      turnos: turnosCreados,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// Actualizar un día POC
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, ubicacion } = req.body;

    const result = await db.query(
      `
      UPDATE poc_dia 
      SET fecha = COALESCE($1, fecha),
          ubicacion = COALESCE($2, ubicacion),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `,
      [fecha, ubicacion, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Día POC no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Eliminar un día POC (también elimina sus turnos por CASCADE)
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM poc_dia WHERE id = $1 RETURNING *",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Día POC no encontrado" });
    }
    res.json({ message: "Día POC eliminado", dia: result.rows[0] });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
};
