import React, { useState, useRef, useEffect } from "react";

const NAV_ITEMS = [
  { key: "live", label: "Live" },
  { key: "members", label: "Members", hasDropdown: true },
  { key: "analysis", label: "Analysis" },
];

const MEMBER_ACTIONS = [
  { key: "add", label: "Add User" },
  { key: "modify", label: "Modify User" },
  { key: "remove", label: "Remove User" },
];

const NavigationBar = ({ activeTab, onTabChange }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNavClick = (key) => {
    if (key === "members") {
      setDropdownOpen((prev) => !prev);
    } else {
      setDropdownOpen(false);
      onTabChange(key, null);
    }
  };

  const handleMemberAction = (actionKey) => {
    setDropdownOpen(false);
    onTabChange("members", actionKey);
  };

  const isActive = (key) => activeTab === key;

  return (
    <div className="sl-nav">
      {NAV_ITEMS.map((item) => (
        <div
          key={item.key}
          className="sl-nav-item-wrapper"
          ref={item.hasDropdown ? dropdownRef : undefined}
        >
          <button
            className={`sl-nav-item ${isActive(item.key) ? "sl-nav-item-active" : ""}`}
            onClick={() => handleNavClick(item.key)}
          >
            {item.label}
            {item.hasDropdown && <span className="sl-nav-arrow">▾</span>}
          </button>

          {item.hasDropdown && dropdownOpen && (
            <div className="sl-dropdown">
              {MEMBER_ACTIONS.map((action) => (
                <button
                  key={action.key}
                  className="sl-dropdown-item"
                  onClick={() => handleMemberAction(action.key)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default NavigationBar;
