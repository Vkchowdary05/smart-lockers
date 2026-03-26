import os
import sys

# Ensure backend imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from datetime import datetime
from backend.config import config
from backend.database.daemon_db import (
    list_all_orgs,
    list_members,
    get_session,
    get_id_column
)

class LockerManagerDB:
    def show_organizations(self):
        try:
            orgs = list_all_orgs()
        except Exception as e:
            print(f"Error fetching organizations: {e}")
            return []
            
        print("\n--- Organizations ---")
        if not orgs:
            print("No organizations found in database.")
            return orgs
            
        for idx, org in enumerate(orgs, 1):
            print(f"{idx}. {org['organization']} (ID: {org['organization_id']}) - Vaults: {org['vault_count']}")
        return orgs
        
    def select_organization(self):
        orgs = self.show_organizations()
        if not orgs:
            return None
            
        choice = input("Select organization by number (or press Enter to cancel): ").strip()
        if not choice:
             return None
             
        try:
             idx = int(choice) - 1
             if 0 <= idx < len(orgs):
                 return orgs[idx]
             else:
                 print("Invalid selection out of range.")
        except ValueError:
             print("Invalid number input.")
        return None

    def show_users(self, org=None):
        if not org:
            org = self.select_organization()
        if not org:
            return
            
        print(f"\n--- Users in {org['organization']} ---")
        try:
            members = list_members(org["organization"], org["organization_id"])
        except Exception as e:
            print(f"Could not load users. (Table may not exist): {e}")
            return
            
        if not members:
            print("No users found.")
            return
            
        id_col = get_id_column(org["mode"])
        for m in members:
            status = f"Assigned to Vault {m['vault_number']}" if m.get("vault_number") else "No locker assigned"
            print(f"ID: {m[id_col]:<5} | Name: {m['name']:<15} | Status: {status}")

    def show_available_lockers(self):
        org = self.select_organization()
        if not org:
            return
            
        print(f"\n--- Available Lockers for {org['organization']} ---")
        vault_count = org.get("vault_count", 0)
        if vault_count <= 0:
            print("This organization has no vaults configured.")
            return

        try:
            members = list_members(org["organization"], org["organization_id"])
        except Exception:
            members = []
            
        assigned_vaults = {m["vault_number"] for m in members if m.get("vault_number") is not None}
        
        available = []
        for v in range(1, vault_count + 1):
            if v not in assigned_vaults:
                available.append(v)
                
        if not available:
            print("No lockers available. All vaults are assigned.")
        else:
            print("Available Lockers:", ", ".join(map(str, available)))

    def show_all_lockers(self):
        org = self.select_organization()
        if not org:
            return
            
        print(f"\n--- All Lockers Status for {org['organization']} ---")
        vault_count = org.get("vault_count", 0)
        if vault_count <= 0:
            print("This organization has no vaults configured.")
            return
            
        try:
            members = list_members(org["organization"], org["organization_id"])
        except Exception:
            members = []
            
        assigned_map = {m["vault_number"]: m for m in members if m.get("vault_number") is not None}
        id_col = get_id_column(org["mode"])
        
        for v in range(1, vault_count + 1):
            if v in assigned_map:
                m = assigned_map[v]
                status = f"Occupied by {m['name']} (ID: {m[id_col]})"
            else:
                status = "Available"
            print(f"Vault: {v:<5} | Status: {status}")

    def search_user(self):
        query = input("Enter user name or ID to search: ").lower().strip()
        if not query:
             print("Search query cannot be empty.")
             return
             
        orgs = list_all_orgs()
        found = False
        print(f"\n--- Search Results for '{query}' ---")
        
        for org in orgs:
            try:
                members = list_members(org["organization"], org["organization_id"])
                id_col = get_id_column(org["mode"])
                for m in members:
                    m_id_str = str(m[id_col]).lower()
                    if query in m["name"].lower() or query in m_id_str:
                        status = f"Assigned to Vault {m['vault_number']}" if m.get("vault_number") else "No locker assigned"
                        print(f"Org: {org['organization']:<15} | ID: {m[id_col]:<5} | Name: {m['name']:<15} | Status: {status}")
                        found = True
            except Exception:
                # Table might not exist yet if org was just created
                pass
                
        if not found:
             print("No matching users found across all organizations.")

    def assign_locker(self):
        org = self.select_organization()
        if not org:
            return
            
        self.show_users(org)
        user_id_str = input("\nEnter User ID to assign a locker: ").strip()
        if not user_id_str:
            return
            
        try:
            user_id = int(user_id_str)
        except ValueError:
            print("Invalid User ID format. Must be an integer.")
            return
            
        try:
            members = list_members(org["organization"], org["organization_id"])
        except Exception as e:
            print(f"Error fetching users: {e}")
            return
            
        id_col = get_id_column(org["mode"])
        user = next((m for m in members if m[id_col] == user_id), None)
        
        if not user:
             print(f"User with ID {user_id} not found in {org['organization']}.")
             return
             
        if user.get("vault_number"):
             print(f"\nUser already has locker {user['vault_number']} assigned.")
             reassign = input("Do you want to reassign them to a new locker? (y/n): ").lower().strip()
             if reassign == 'y' or reassign == 'yes':
                 self._update_vault(org, user_id, None)
                 print(f"Released locker {user['vault_number']} for user.")
             else:
                 print("Operation cancelled.")
                 return

        assigned_vaults = {
            m["vault_number"] for m in members 
            if m.get("vault_number") is not None and m[id_col] != user_id
        }
        vault_count = org.get("vault_count", 0)
        
        available = [v for v in range(1, vault_count + 1) if v not in assigned_vaults]
        if not available:
            print("No available lockers in this organization. All lockers are occupied.")
            return
            
        print("\nAvailable Lockers:", ", ".join(map(str, available[:30])) + ("..." if len(available) > 30 else ""))
        
        locker_id_str = input("\nEnter Locker Number to assign (or 'auto' for first available): ").strip()
        if locker_id_str.lower() == 'auto':
            vault_num = available[0]
        else:
            try:
                vault_num = int(locker_id_str)
                if vault_num not in available:
                    print("Locker is not available or invalid locker number.")
                    return
            except ValueError:
                print("Invalid locker number format.")
                return
                
        success = self._update_vault(org, user_id, vault_num)
        if success:
            print(f"\n=> Successfully assigned Vault {vault_num} to {user['name']} (ID: {user[id_col]}).")
        else:
            print("\n=> Failed to assign vault.")

    def remove_locker_assignment(self):
        org = self.select_organization()
        if not org:
            return
            
        self.show_users(org)
        user_id_str = input("\nEnter User ID to remove their locker assignment: ").strip()
        try:
            user_id = int(user_id_str)
        except ValueError:
            print("Invalid User ID format.")
            return
            
        members = list_members(org["organization"], org["organization_id"])
        id_col = get_id_column(org["mode"])
        user = next((m for m in members if m[id_col] == user_id), None)
        
        if not user:
            print("User not found.")
            return
            
        if user.get("vault_number"):
            success = self._update_vault(org, user_id, None)
            if success:
                print(f"Successfully removed locker assignment for User {user_id}. Vault {user['vault_number']} is now available.")
            else:
                print("Failed to remove locker assignment.")
        else:
            print("User does not currently have a locker assigned.")

    def _update_vault(self, org, user_id, vault_num):
         try:
             table = config.get_org_table_name(org["organization"], org["organization_id"])
             log_table = f"{table}_logs"
             id_col = get_id_column(org["mode"])
             now = datetime.now()
             
             with get_session() as session:
                 # Update the member's assigned vault
                 session.execute(
                     text(f'UPDATE "{table}" SET vault_number = :vault WHERE "{id_col}" = :uid'),
                     {"vault": vault_num, "uid": user_id}
                 )
                 
                 # Record in logs table
                 if vault_num is not None:
                     # Check-in: Assigning a new locker
                     session.execute(
                         text(f'''
                             INSERT INTO "{log_table}" 
                             (org_id, device_mac, vault_id, checkin_timestamp, "{id_col}")
                             VALUES (:org_id, :mac, :vault, :now, :uid)
                         '''),
                         {
                             "org_id": org["organization_id"],
                             "mac": org.get("mac", "UNKNOWN"),
                             "vault": vault_num,
                             "now": now,
                             "uid": user_id
                         }
                     )
                 else:
                     # Check-out: Releasing a locker
                     # Find the most recent active log for this user and vault that doesn't have a checkout time
                     session.execute(
                         text(f'''
                             UPDATE "{log_table}"
                             SET checkout_timestamp = :now
                             WHERE "{id_col}" = :uid
                               AND checkout_timestamp IS NULL
                         '''),
                         {"now": now, "uid": user_id}
                     )
                     
             return True
         except Exception as e:
             print(f"Database update error: {e}")
             return False

    def view_all_allocations(self):
        org = self.select_organization()
        if not org:
            return
            
        print(f"\n--- All Locker Allocations for {org['organization']} ---")
        try:
            members = list_members(org["organization"], org["organization_id"])
        except Exception as e:
            print(f"Error fetching members: {e}")
            return
            
        id_col = get_id_column(org["mode"])
        allocations = False
        
        for m in sorted(members, key=lambda x: x.get("vault_number") or 999999):
            if m.get("vault_number"):
                print(f"Vault: {m['vault_number']:<5} | Assigned to: {m['name']} (ID: {m[id_col]})")
                allocations = True
                
        if not allocations:
            print("No lockers are currently allocated in this organization.")

def main():
    manager = LockerManagerDB()
    
    while True:
        print("\n" + "="*45)
        print("          DB-BACKED LOCKER ALLOCATION SYSTEM")
        print("="*45)
        print("1. View all organizations")
        print("2. Show users in an organization")
        print("3. View available lockers")
        print("4. View locker statuses (All)")
        print("5. Search for a user")
        print("6. Assign or Reassign a locker")
        print("7. Remove a locker assignment")
        print("8. View all locker allocations")
        print("9. Exit")
        print("="*45)
        
        choice = input("Enter your choice (1-9): ").strip()
        
        try:
            if choice == '1':
                manager.show_organizations()
            elif choice == '2':
                manager.show_users()
            elif choice == '3':
                manager.show_available_lockers()
            elif choice == '4':
                manager.show_all_lockers()
            elif choice == '5':
                manager.search_user()
            elif choice == '6':
                manager.assign_locker()
            elif choice == '7':
                manager.remove_locker_assignment()
            elif choice == '8':
                manager.view_all_allocations()
            elif choice == '9':
                print("Exiting system. Goodbye!")
                break
            else:
                print("Invalid choice. Please enter a number between 1 and 9.")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    main()
