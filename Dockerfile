# Stage-1 dependencies
FROM node:latest as dep

WORKDIR /usr/app

ADD package.json .
ADD yarn.lock .
RUN ["yarn", "install"]


# Stage-2 final image
FROM node:alpine

WORKDIR /usr/app

COPY --from=dep /usr/app/node_modules ./node_modules

ADD . .

ENTRYPOINT [ "yarn", "dev" ]
