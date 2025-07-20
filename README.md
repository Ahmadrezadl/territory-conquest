# Territory Conquest

A minimalist real-time strategy game of expansion and domination. Customize your match, command your armies, and conquer the entire map to claim victory.

---

### **[🎮 Play the Live Game Here!](https://ahmadrezadl.github.io/territory-conquest/)**

---

![Territory Conquest Gameplay](https://i.imgur.com/gI2F1iL.png)

## About the Game

Territory Conquest is a strategic area-control game where the objective is simple: eliminate all opponents by taking over their territories. 

Each territory you own generates units over time. Send your units to reinforce your own territories or to attack and conquer neutral or enemy-owned territories. The last player standing wins!

## Features

-   **Dynamic Map Generation:** Every game is played on a unique, procedurally generated map, ensuring endless replayability.
-   **Customizable Game Setup:** Configure your game exactly how you want. Add up to 10 players, customize their names and colors, and toggle between human and bot opponents. Your setup is automatically saved in your browser for next time!
-   **Intelligent Bot AI:** Play solo against challenging bots that will expand, reinforce, and consolidate their forces to fight for control of the map.
-   **Responsive Design:** Enjoy a seamless experience whether you're playing on a desktop, tablet, or mobile phone. The game interface scales perfectly to any screen size.
-   **Clean, Modern UI:** A sleek and intuitive interface that makes it easy to jump right into the action.

## How to Play

1.  **Configure Your Match:**
    * Use the setup menu to add or remove players.
    * Customize each player's name and color.
    * Click the "Human" / "Bot" button to toggle between a player-controlled or AI-controlled territory.

2.  **Start the Game:**
    * Click the "Start Game" button to begin the conquest.

3.  **Gameplay:**
    * Your territories (and those of other human players) will have a subtle **glow**.
    * Click on one of your territories to select it.
    * Click the **white arrow** pointing to an adjacent territory to send half of your selected units to attack or reinforce it.
    * The goal is to conquer every territory on the map. The last player with territories remaining wins!

## Tech Stack

-   **Frontend:** HTML5, CSS3, Vanilla JavaScript
-   **Map Generation:** The Delaunay triangulation part of the map generation is powered by the [d3-delaunay](https://github.com/d3/d3-delaunay) library.

## How to Run Locally

To run the game on your local machine, follow these simple steps:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/ahmadrezadl/territory-conquest.git](https://github.com/ahmadrezadl/territory-conquest.git)
    ```

2.  **Navigate to the directory:**
    ```bash
    cd territory-conquest
    ```

3.  **Open the game:**
    * Simply open the `index.html` file in your favorite web browser.
