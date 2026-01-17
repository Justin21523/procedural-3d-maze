import React from 'react';

export const GameApiContext = React.createContext(null);

export function GameApiProvider({ gameApi, children }) {
  return (
    <GameApiContext.Provider value={gameApi || null}>
      {children}
    </GameApiContext.Provider>
  );
}

export function useGameApi() {
  return React.useContext(GameApiContext);
}

