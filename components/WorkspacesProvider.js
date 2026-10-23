'use client';

import { createContext, useContext } from 'react';

const WorkspacesContext = createContext([]);

export default function WorkspacesProvider({ workspaces, children }) {
  return (
    <WorkspacesContext.Provider value={workspaces}>
      {children}
    </WorkspacesContext.Provider>
  );
}

export function useInitialWorkspaces() {
  return useContext(WorkspacesContext);
}
