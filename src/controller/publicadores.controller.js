const db = require('../database');

// Listar todos los publicadores
const getAll = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, 
             pareja.nombre as pareja_nombre,
             tutor.nombre as tutor_nombre
      FROM publicadores p
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      LEFT JOIN publicadores tutor ON p.tutor_id = tutor.id
      ORDER BY p.nombre
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener un publicador por ID
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM publicadores WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Publicador no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Crear publicador
const create = async (req, res) => {
  try {
    const { nombre, tipo, pareja_id, tutor_id, activo } = req.body;
    const result = await db.query(`
      INSERT INTO publicadores (nombre, tipo, pareja_id, tutor_id, activo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [nombre, tipo || 'solo', pareja_id || null, tutor_id || null, activo !== false]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Actualizar publicador
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, pareja_id, tutor_id, activo } = req.body;
    
    const result = await db.query(`
      UPDATE publicadores 
      SET nombre = COALESCE($1, nombre),
          tipo = COALESCE($2, tipo),
          pareja_id = $3,
          tutor_id = $4,
          activo = COALESCE($5, activo),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `, [nombre, tipo, pareja_id, tutor_id, activo, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Publicador no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Eliminar publicador
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM publicadores WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Publicador no encontrado' });
    }
    res.json({ message: 'Publicador eliminado' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};