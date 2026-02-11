/** @type {import('next').NextConfig} */
const isGithubActions = process.env.GITHUB_ACTIONS === 'true';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';

const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  basePath: isGithubActions && repoName ? `/${repoName}` : '',
  assetPrefix: isGithubActions && repoName ? `/${repoName}/` : undefined,
};

export default nextConfig;
