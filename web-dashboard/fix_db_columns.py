import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.database.daemon_db import get_session, list_all_orgs
from sqlalchemy import text

def main():
    try:
        orgs = list_all_orgs()
    except Exception as e:
        print(f"Could not load orgs: {e}")
        return

    with get_session() as session:
        for org in orgs:
            org_name = org['organization'].lower().replace(' ', '')
            table = f"{org_name}_{org['organization_id']}"
            try:
                # Add vault_number if it doesn't exist
                session.execute(text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS vault_number integer'))
                print(f"Verified/Added vault_number column for table {table}")
            except Exception as e:
                print(f"Error altering table {table}: {e}")

if __name__ == "__main__":
    main()
