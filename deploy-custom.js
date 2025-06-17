const ghpages = require('gh-pages');
const path = require('path');

console.log('Starting deployment to GitHub Pages...');

ghpages.publish(
  path.join(process.cwd(), 'build'),
  {
    branch: 'gh-pages',
    repo: 'https://github.com/rmiyagi13/kb-in-line-citations.git',
    message: 'Auto-generated deployment to GitHub Pages',
    dotfiles: true // Include dotfiles like .nojekyll
  },
  (err) => {
    if (err) {
      console.error('Deployment error:', err);
      return;
    }
    console.log('Deployment complete!');
  }
); 