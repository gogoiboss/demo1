import sqlite3
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def seed_database():
    replay_dir = Path("data/replay")
    db_path = replay_dir / "ntes_capture.db"
    
    if not replay_dir.exists():
        logger.error(f"Replay directory {replay_dir} not found.")
        return
        
    logger.info(f"Seeding database at {db_path}...")
    
    # Create or overwrite DB
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("DROP TABLE IF EXISTS live_status")
    c.execute("DROP TABLE IF EXISTS route")
    
    c.execute('''CREATE TABLE live_status 
                 (train_number TEXT PRIMARY KEY, data TEXT)''')
    c.execute('''CREATE TABLE route 
                 (train_number TEXT PRIMARY KEY, data TEXT)''')
                 
    # Load JSON files
    for file in replay_dir.glob("*.json"):
        try:
            with open(file, "r", encoding="utf-8") as f:
                data = f.read()
                
            parts = file.stem.split("_")
            if len(parts) >= 2:
                train_number = parts[0]
                type_name = parts[1]
                
                if type_name == "live":
                    c.execute("INSERT OR REPLACE INTO live_status (train_number, data) VALUES (?, ?)", 
                              (train_number, data))
                    logger.info(f"Seeded live status for {train_number}")
                elif type_name == "route":
                    c.execute("INSERT OR REPLACE INTO route (train_number, data) VALUES (?, ?)", 
                              (train_number, data))
                    logger.info(f"Seeded route for {train_number}")
        except Exception as e:
            logger.error(f"Failed to seed {file.name}: {e}")
            
    conn.commit()
    conn.close()
    logger.info("Database seeding complete.")

if __name__ == "__main__":
    seed_database()
