const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Cria ou abre o banco de dados SQLite
const dbPath = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

// Inicializa as tabelas
db.serialize(() => {
  // Tabela de usuários
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      downloads_count INTEGER DEFAULT 0,
      is_premium INTEGER DEFAULT 0,
      premium_expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabela de downloads (histórico)
  db.run(`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      video_url TEXT,
      downloaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);
});

class Database {
  // Obter ou criar usuário
  static getUser(userId, username, firstName) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            resolve(row);
          } else {
            // Criar novo usuário
            db.run(
              'INSERT INTO users (user_id, username, first_name) VALUES (?, ?, ?)',
              [userId, username || null, firstName || null],
              function(err) {
                if (err) {
                  reject(err);
                  return;
                }
                // Retornar o usuário recém-criado
                resolve({
                  user_id: userId,
                  username: username,
                  first_name: firstName,
                  downloads_count: 0,
                  is_premium: 0,
                  premium_expires_at: null
                });
              }
            );
          }
        }
      );
    });
  }

  // Incrementar contador de downloads
  static incrementDownload(userId, videoUrl) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET downloads_count = downloads_count + 1 WHERE user_id = ?',
        [userId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Registrar no histórico
          db.run(
            'INSERT INTO downloads (user_id, video_url) VALUES (?, ?)',
            [userId, videoUrl],
            (err) => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            }
          );
        }
      );
    });
  }

  // Verificar se usuário pode baixar (tem créditos ou é premium)
  static canDownload(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT downloads_count, is_premium, premium_expires_at FROM users WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            resolve({ canDownload: true, reason: 'new_user' });
            return;
          }

          const FREE_DOWNLOADS_LIMIT = 20;
          const isPremium = row.is_premium === 1;
          
          // Verificar se é premium e se ainda está válido
          if (isPremium && row.premium_expires_at) {
            const expiresAt = new Date(row.premium_expires_at);
            const now = new Date();
            if (expiresAt > now) {
              resolve({ canDownload: true, reason: 'premium' });
              return;
            } else {
              // Premium expirado, atualizar status
              db.run('UPDATE users SET is_premium = 0 WHERE user_id = ?', [userId]);
            }
          }

          // Verificar limite de downloads gratuitos
          if (row.downloads_count < FREE_DOWNLOADS_LIMIT) {
            resolve({ 
              canDownload: true, 
              reason: 'free',
              remaining: FREE_DOWNLOADS_LIMIT - row.downloads_count
            });
          } else {
            resolve({ 
              canDownload: false, 
              reason: 'limit_reached',
              used: row.downloads_count,
              limit: FREE_DOWNLOADS_LIMIT
            });
          }
        }
      );
    });
  }

  // Ativar premium
  static activatePremium(userId, days = 30) {
    return new Promise((resolve, reject) => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

      db.run(
        'UPDATE users SET is_premium = 1, premium_expires_at = ? WHERE user_id = ?',
        [expiresAt.toISOString(), userId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(expiresAt);
        }
      );
    });
  }

  // Obter estatísticas do usuário
  static getStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT downloads_count, is_premium, premium_expires_at FROM users WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || {
            downloads_count: 0,
            is_premium: 0,
            premium_expires_at: null
          });
        }
      );
    });
  }
}

module.exports = Database;

