let scores = {
  A: 25000,
  B: 25000,
  C: 25000,
  D: 25000
};

function addScore(player, value) {
  scores[player] += value;
  document.getElementById("score" + player).textContent = scores[player];
}