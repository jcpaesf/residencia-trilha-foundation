echo "Building ./site folder"
npm --prefix site run build

echo "Syncing with S3"
aws s3 sync ./site/dist s3://residencia-foundation-site-365118287526 \
  --delete

echo "Cleaning CloudFront cache"
aws cloudfront create-invalidation \
  --distribution-id E1574D9L0OHOTP \
  --paths "/index.html"

echo "Build Successfully!"