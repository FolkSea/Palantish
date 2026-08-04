"use client";

import { createContext, useContext, type ReactNode } from "react";

const AdministratorContext = createContext(false);

/**
 * Whether the reader is an administrator, for controls that only they should be
 * offered.
 *
 * Seeded from the server in the root layout and read through context rather
 * than passed down, because the controls that need it (report row actions) are
 * rendered from ten different places - threading a prop through every list,
 * card and panel to reach them would be a lot of churn for one boolean.
 *
 * This is presentation only. Hiding a button is not a permission check: every
 * server action is POST-invocable by any session whatever the UI renders, so
 * the action does its own check and that is the one that matters.
 */
export function ViewerRoleProvider({
  isAdministrator,
  children,
}: {
  isAdministrator: boolean;
  children: ReactNode;
}) {
  return (
    <AdministratorContext.Provider value={isAdministrator}>
      {children}
    </AdministratorContext.Provider>
  );
}

/** True when the signed-in reader is an administrator. False when signed out. */
export function useIsAdministrator(): boolean {
  return useContext(AdministratorContext);
}
